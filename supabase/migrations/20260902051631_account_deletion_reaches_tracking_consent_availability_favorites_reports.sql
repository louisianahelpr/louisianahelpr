-- Account deletion, part three: the five tables an empirical census could not find.
--
-- ── Why there is a part three ───────────────────────────────────────────────
-- 20260901033011 fixed every FOREIGN KEY pointing at auth.users. 20260902014651
-- then covered the tables that reference a user by a bare uuid with no FK at
-- all, and it found them empirically: it deleted one test account and queried
-- 87 (table, column) pairs for that uuid. Ten still held it, and those ten were
-- fixed.
--
-- That method is sound but it is blind by construction to any table the test
-- account happened to hold no rows in. It can only find what that ONE user had.
--
-- These five were found the other way round — rows were SEEDED into each table
-- first, and only then was the live purge run. Five of six seeded rows survived
-- a deletion that reported success.
--
-- ── Verified against prod before this was written ───────────────────────────
-- Not inferred from migration history (fncmgoasalhdgfwzhsqa, 2026-09-02):
--
--   select prosrc like '%legal_acceptances%' from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'purge_user_data';
--   -> false. And false for job_tracking, helper_availability,
--      favorite_helpers and reports. The deployed function names none of them.
--
--   Orphan census the same day (rows whose owner is absent from auth.users):
--     legal_acceptances.user_id       8      <-- ALL EIGHT hold a non-null
--                                                 ip_address AND user_agent
--     job_tracking.helper_id          0
--     helper_availability.helper_id   0
--     favorite_helpers.customer_id    0
--     favorite_helpers.helper_id      0
--     reports.reporter_id             0
--
-- The four zeroes are not evidence of health: no deleted user had happened to
-- hold such a row yet. The gap is identical in all five; only one has been
-- tripped. And the eight that DID trip it are dated 2026-09-02 — they are the
-- audit lanes' own test-account deletions, which is as clean a demonstration as
-- there is: the deletion path ran, returned a success report with 23 counters,
-- and left the person's IP address and user agent sitting in the table.
--
-- Residual PII after a completed deletion is a compliance finding under GDPR
-- and CCPA, and Apple requires in-app account deletion to actually work.
--
-- ── Bucket, per table ───────────────────────────────────────────────────────
-- ERASE   job_tracking         their GPS breadcrumbs during a job
--         helper_availability  their schedule
--         favorite_helpers     their saved list AND their row in everyone else's
-- ANONYMISE
--         legal_acceptances    row kept (terms version + timestamp has aggregate
--                              value); user_id, ip_address, user_agent nulled
--         reports              row kept (it protects the person reported ON);
--                              reporter_id nulled
--
-- ── Ordering ────────────────────────────────────────────────────────────────
-- The two ANONYMISE columns are NOT NULL today, so they are made nullable
-- BEFORE the function that writes NULL into them — same reason and same shape
-- as the 13 columns 20260901033011 and 20260902014651 already relaxed.
-- Replay-safe: every statement is guarded and re-running is a no-op.

-- ── 1. Make the two anonymise targets nullable ──────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    ALTER TABLE public.legal_acceptances ALTER COLUMN user_id DROP NOT NULL;
  END IF;
  IF to_regclass('public.reports') IS NOT NULL THEN
    ALTER TABLE public.reports ALTER COLUMN reporter_id DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.legal_acceptances.user_id IS
  'NULL means the acceptance survived the account being deleted: purge_user_data() '
  'nulls this together with ip_address and user_agent, keeping the terms/privacy '
  'version and timestamp as an anonymous record that someone accepted that version.';

COMMENT ON COLUMN public.reports.reporter_id IS
  'NULL means the reporter deleted their account. The report itself is retained '
  'deliberately - it is a safety record about the person named in reported_id, '
  'who has not asked to be forgotten. Readers must treat NULL as "deleted user" '
  'and must not build a profile link from it.';

-- ── 2. purge_user_data(), extended ──────────────────────────────────────────
-- Full body restated because Postgres has no way to append to a function. The
-- only differences from the 20260902014651 definition are the five declarations,
-- the 4i-4k block and the five extra counters in the returned jsonb.
CREATE OR REPLACE FUNCTION public.purge_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jobs_deleted   int := 0;
  v_jobs_redacted  int := 0;
  v_messages       int := 0;
  v_notifications  int := 0;
  v_push_tokens    int := 0;
  v_prefs          int := 0;
  v_payouts        int := 0;
  v_profile        int := 0;
  v_nolog          int := 0;
  v_login          int := 0;
  v_saved          int := 0;
  v_fraud          int := 0;
  v_ref_codes      int := 0;
  v_ref_credits    int := 0;
  v_ref_credits_an int := 0;
  v_referrals      int := 0;
  v_referrals_an   int := 0;
  v_roster         int := 0;
  v_analytics      int := 0;
  v_errorlogs      int := 0;
  v_tracking       int := 0;
  v_availability   int := 0;
  v_favorites      int := 0;
  v_consent_an     int := 0;
  v_reports_an     int := 0;
  v_jobs_kept_fk   int := 0;
  v_pif            int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'purge_user_data: p_user_id is required';
  END IF;

  -- 4a. Jobs the user POSTED that touched nobody and no money. Erase outright.
  --
  --     Scoped to customer_id ONLY. A job where this user was merely the
  --     helper is the POSTER's record — deleting it would destroy a third
  --     party's history to satisfy this user's request. The FK conversion in
  --     the previous migration nulls helper_id on those instead.
  --
  --     The money test is an ALLOWLIST (`payment_status = 'unpaid'`), not a
  --     denylist: when a new payment_status is added, an allowlist retains the
  --     row by default and a denylist deletes it. For a destructive predicate,
  --     default-retain is the only safe direction. `helper_id IS NULL` is the
  --     other half — once a helper was assigned, the job is part of THEIR work
  --     history too.
  --
  --     ── Why this is a loop with an exception handler ────────────────────
  --     The three NOT EXISTS clauses below cover `payout_transfers`, `reviews`
  --     and `applications`. They are NOT the whole set: eight further tables
  --     reference `jobs(id)` with no ON DELETE clause, i.e. NO ACTION —
  --     `user_violations.job_id`, `user_strikes.job_id`, `pif_credits.job_id`,
  --     `skill_endorsements.job_id`, `home_maintenance_reminders.last_job_id`,
  --     `worker_protection_credits.job_id`, `str_processed_events.job_id`, and
  --     `jobs.parent_job_id`. A cancelled, unpaid, unassigned job carrying a
  --     `user_violations` row — which `apply_cancellation_violation_consequence`
  --     writes routinely — would raise 23503 and abort this entire transaction,
  --     which is exactly the permanent-refusal failure these two migrations
  --     exist to eliminate.
  --
  --     Enumerating all eleven would work today and rot the moment somebody
  --     adds a twelfth. Instead each delete is attempted individually and a
  --     foreign-key violation is caught and treated as "this job belongs to
  --     someone else's record after all" — the job stays, and step 4b redacts
  --     it like any other retained job. Default-retain, enforced by the
  --     database rather than by a list somebody has to remember to update.
  DECLARE
    v_job_id uuid;
  BEGIN
    FOR v_job_id IN
      SELECT j.id
      FROM public.jobs j
      WHERE j.customer_id = p_user_id
        AND COALESCE(j.payment_status, 'unpaid') = 'unpaid'
        AND j.helper_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt WHERE pt.job_id = j.id)
        AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.job_id = j.id)
        AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
    LOOP
      BEGIN
        DELETE FROM public.jobs WHERE id = v_job_id;
        v_jobs_deleted := v_jobs_deleted + 1;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Something else still points at this job. Keep it; 4b redacts it.
        v_jobs_kept_fk := v_jobs_kept_fk + 1;
      END;
    END LOOP;
  END;

  -- 4b. Jobs the user POSTED that DID carry money: retain the financial record,
  --     strip the free text that identifies them. `location` is the poster's
  --     street address and `description` routinely carries a phone number or a
  --     gate code. Title, budget, fees, dates, status and the Stripe ids stay —
  --     that is what makes the row reconcilable, and it is also all the
  --     counterparty needs to recognise the job in their own history.
  WITH upd AS (
    UPDATE public.jobs
       SET location             = NULL,
           latitude             = NULL,
           longitude            = NULL,
           description          = '[removed at account deletion]',
           special_requirements = NULL
     WHERE customer_id = p_user_id
       AND description IS DISTINCT FROM '[removed at account deletion]'
    RETURNING id
  )
  SELECT count(*) INTO v_jobs_redacted FROM upd;

  -- 4c. The tables that carry PII and have NO foreign key at all, so nothing
  --     cascades and nothing would ever clean them up.
  --
  --     Scoped to `sender_id` ONLY. Deleting on `receiver_id` too would destroy
  --     messages the COUNTERPARTY wrote — the identical mistake to cascading
  --     away the reviews this user authored, just pointed the other way. What
  --     someone else typed is their record; the departing user's own words are
  --     the thing being erased. The counterparty is left with a one-sided
  --     thread, which is the honest representation of "the other person left".
  --
  --     The caller purges `message-attachments` for these rows BEFORE calling
  --     this function, because `messages.attachment_url` is the ONLY pointer to
  --     those objects — deleting the row first would strand the file in storage
  --     permanently with nothing left to locate it by.
  WITH del AS (
    DELETE FROM public.messages
     WHERE sender_id = p_user_id
    RETURNING id
  ) SELECT count(*) INTO v_messages FROM del;

  WITH del AS (
    DELETE FROM public.notifications WHERE user_id = p_user_id RETURNING id
  ) SELECT count(*) INTO v_notifications FROM del;

  -- Privacy-critical: a token that survives deletion keeps delivering this
  -- person's notifications to whatever device still holds it.
  WITH del AS (
    DELETE FROM public.push_tokens WHERE user_id = p_user_id RETURNING id
  ) SELECT count(*) INTO v_push_tokens FROM del;

  WITH del AS (
    DELETE FROM public.notification_preferences WHERE user_id = p_user_id RETURNING id
  ) SELECT count(*) INTO v_prefs FROM del;

  -- 4d. Stamp the payout ledger rows so the NULL helper_id they are about to
  --     receive reads as a deliberate redaction rather than an incomplete
  --     write. Done BEFORE the auth delete, while helper_id still names them.
  WITH upd AS (
    UPDATE public.payout_transfers
       SET helper_redacted_at = now()
     WHERE helper_id = p_user_id
       AND helper_redacted_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_payouts FROM upd;

  -- 4e. Redact the profile in place. The row CASCADEs away with the auth user
  --     moments later, so this looks redundant — it is not. It is what makes
  --     the sequence resumable: if the auth delete then fails, the account is
  --     left with no name, no phone, no address, no date of birth and no
  --     document pointer, and a retry finishes the job. Guarded on
  --     `anonymized_at`, one column that means exactly "this row has been
  --     through the purge", rather than a hand-maintained sample of the columns
  --     being nulled that can drift out of sync with the SET list.
  WITH upd AS (
    UPDATE public.profiles
       SET full_name                = NULL,
           phone                    = NULL,
           avatar_url               = NULL,
           id_document_url          = NULL,
           insurance_url            = NULL,
           license_url              = NULL,
           date_of_birth            = NULL,
           location                 = NULL,
           latitude                 = NULL,
           longitude                = NULL,
           zip_code                 = NULL,
           bio                      = NULL,
           business_name            = NULL,
           emergency_contact_name   = NULL,
           emergency_contact_phone  = NULL,
           portfolio_urls           = NULL,
           extra_comments           = NULL,
           hear_about_us            = NULL,
           tools_equipment          = NULL,
           email                    = NULL,
           anonymized_at            = now()
     WHERE user_id = p_user_id
       AND anonymized_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_profile FROM upd;

  -- 4f. ERASE — the no-FK tables holding this person's own artifacts. Each of
  --     these was proven to survive a completed deletion by querying prod for
  --     the deleted uuid; see the header. `notification_logs` and
  --     `login_history` lead because they hold literal PII (an email address
  --     and an IP), not just a pseudonymous id.
  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.notification_logs WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_nolog FROM del;
  END IF;

  IF to_regclass('public.login_history') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.login_history WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_login FROM del;
  END IF;

  IF to_regclass('public.saved_jobs') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.saved_jobs WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_saved FROM del;
  END IF;

  -- A fraud flag is a judgment about an identified individual. Once the account
  -- is gone the flag can no longer gate anything, and keeping an accusation
  -- about someone who asked to be forgotten is the same call the first
  -- migration made when it left reviews.reviewee_id on CASCADE.
  IF to_regclass('public.fraud_flags') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.fraud_flags WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_fraud FROM del;
  END IF;

  -- 4g. Referral economy. Their own code and their own unspent balance are
  --     erased; anything that belongs to the OTHER party is anonymised so that
  --     party keeps the credit they earned.
  --
  --     Order matters: referral_credits and referrals both point at
  --     referral_codes(id) with a real FK, so the codes go last.
  IF to_regclass('public.referral_credits') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.referral_credits
         SET referred_user_id = NULL
       WHERE referred_user_id = p_user_id
         AND user_id IS DISTINCT FROM p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_ref_credits_an FROM upd;

    WITH del AS (DELETE FROM public.referral_credits WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_ref_credits FROM del;
  END IF;

  IF to_regclass('public.referrals') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.referrals
         SET referrer_id = NULL
       WHERE referrer_id = p_user_id
         AND referred_id IS DISTINCT FROM p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_referrals_an FROM upd;

    WITH del AS (DELETE FROM public.referrals WHERE referred_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_referrals FROM del;
  END IF;

  IF to_regclass('public.referral_codes') IS NOT NULL THEN
    -- ANONYMISED, not deleted — see the DROP NOT NULL note above. Deleting the
    -- row raised 23503 from a third party's `referrals` row, and nulling that
    -- third party's pointer to make the delete legal would have broken
    -- `check_referral_bonus`'s dedupe key and re-minted their bonus forever.
    --
    -- `code` is rewritten as well as `user_id` nulled, and that half is load-
    -- bearing: a code left readable is a live coupon with no owner, and a new
    -- signup entering it would mint credit toward an account that no longer
    -- exists. The replacement keeps the UNIQUE constraint satisfied and is not
    -- guessable from the original.
    WITH upd AS (
      UPDATE public.referral_codes
         SET user_id = NULL,
             code    = 'REDACTED-' || replace(id::text, '-', '')
       WHERE user_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_ref_codes FROM upd;
  END IF;

  -- 4g-bis. ANONYMISE — behavioural logs.
  --
  --   Found by a different method to the rest: rather than deleting a test
  --   account and looking for what survived, every user-shaped uuid column in
  --   the exposed schema was compared against the LIVE auth.users set. 173 prod
  --   rows name a user who no longer exists, and `analytics_events.user_id`
  --   (63 rows, 3 departed users) is the one that is neither a compliance trail
  --   nor already covered above.
  --
  --   These are ANONYMISED, not deleted, and the distinction is the point: an
  --   event stream exists to be counted in aggregate, and deleting rows would
  --   silently rewrite historical funnels every time somebody closed their
  --   account. Severing the actor keeps the count honest and leaves nothing
  --   attributable. `error_logs` gets the same treatment defensively — it
  --   currently holds no orphans, which only means nobody with an error row has
  --   left yet.
  --
  --   Deliberately NOT touched: `admin_audit_log.admin_id`, the largest orphan
  --   set at 100 rows. That is the compliance trail — "who did what to whom" —
  --   and it is supposed to outlive the admin who left. It has no FK for the
  --   same reason.
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.analytics_events SET user_id = NULL
       WHERE user_id = p_user_id RETURNING id
    ) SELECT count(*) INTO v_analytics FROM upd;
  END IF;

  IF to_regclass('public.error_logs') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.error_logs SET user_id = NULL
       WHERE user_id = p_user_id RETURNING id
    ) SELECT count(*) INTO v_errorlogs FROM upd;
  END IF;

  -- 4g-ter. Close the Pay-It-Forward re-claim hole that the FK conversion in
  --   the first migration opens.
  --
  --   `pif_credits.recipient_id` goes CASCADE -> SET NULL, so a gift this user
  --   had CLAIMED reverts to `recipient_id IS NULL` while `status` stays
  --   'sent'. `claim-pif-credit/index.ts:90` refuses only when recipient_id is
  --   non-null and `:129` binds only `.is("recipient_id", null)` — so the row
  --   reads as unclaimed again. `recipient_email` is the departed person's
  --   address, it was never purged, and their email is freed the moment
  --   auth.admin.deleteUser runs. Whoever holds the gift link and can receive
  --   at that address could re-claim donor-funded money.
  --
  --   Nulling `recipient_email` closes it using logic already in that function:
  --   `:112` refuses a token-only claim outright when the gift names no
  --   recipient ("a bearer-only token that anyone could claim is never valid
  --   for a directed gift"). It fails closed, which is what we want. The
  --   donor's record and the amount are untouched.
  IF to_regclass('public.pif_credits') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.pif_credits
         SET recipient_email = NULL
       WHERE recipient_id = p_user_id
         AND recipient_email IS NOT NULL
      RETURNING id
    ) SELECT count(*) INTO v_pif FROM upd;
  END IF;

  -- 4h. ANONYMISE — the group-job roster. Only the LEAD helper is ever written
  --     to jobs.helper_id; every other helper on a group job exists solely as a
  --     row here. Deleting the row would quietly shrink the poster's record of
  --     who worked a completed, paid job, so the row stays and the identity
  --     goes. (The same gap on the read side let a non-lead group helper delete
  --     their account mid-job — closed in _shared/accountPurge.ts
  --     `findActiveWork`, which now reads this table too.)
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.group_job_helpers
         SET helper_id = NULL
       WHERE helper_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_roster FROM upd;
  END IF;

  -- ── 4i–4k. The five tables the 20260902014651 census could not have found ──
  --
  --   That migration built its list empirically: it deleted one test account
  --   and looked for that uuid across 87 (table, column) pairs. The method is
  --   sound but it is blind by construction to any table the test account
  --   happened to hold no rows in — it can only find what that one user had.
  --   These five were found the other way round: rows were SEEDED into each
  --   table first, and only then was the purge run. Five of six seeded rows
  --   survived a "successful" deletion.
  --
  --   Confirmed against prod (fncmgoasalhdgfwzhsqa, 2026-09-02) before this
  --   was written, rather than inferred from migration history:
  --     select prosrc like '%legal_acceptances%' from pg_proc
  --      where proname = 'purge_user_data'   ->  false, and false for all five.
  --   Orphan census the same day: legal_acceptances 8 rows, ALL EIGHT holding
  --   a non-null ip_address AND user_agent. The other four sat at 0 only
  --   because no deleted user had happened to have such a row yet — the gap is
  --   identical, it just has not been tripped.
  --
  --   All five reference a user by a bare uuid with NO foreign key, so nothing
  --   cascades and the retention policy in 20260901033011 never applies.

  -- 4i. ERASE — live location history. `job_tracking` holds the helper's
  --     latitude/longitude breadcrumbs while a job is in progress. Its only FK
  --     is to `jobs` (ON DELETE CASCADE), and funded jobs are deliberately
  --     RETAINED and redacted rather than deleted (step 4b), so the GPS trail
  --     of a departed person outlives them on exactly the jobs that matter.
  --     There is no anonymise option worth having here: a co-ordinate track is
  --     identifying on its own, and `helper_id` is NOT NULL.
  IF to_regclass('public.job_tracking') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.job_tracking WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_tracking FROM del;
  END IF;

  -- 4j. ERASE — their own schedule and their own saved-helper list, plus every
  --     OTHER user's saved row that names them.
  --
  --     The second direction is the one that is easy to miss and is the more
  --     visible defect: `favorite_helpers` is deleted by `customer_id` (their
  --     list) AND by `helper_id` (their presence in everyone else's list). Left
  --     alone, a deleted helper stays pinned in strangers' saved-helpers tabs
  --     forever, pointing at a redacted profile.
  IF to_regclass('public.helper_availability') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.helper_availability WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_availability FROM del;
  END IF;

  IF to_regclass('public.favorite_helpers') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.favorite_helpers
       WHERE customer_id = p_user_id OR helper_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_favorites FROM del;
  END IF;

  -- 4k. ANONYMISE — the consent record and the reports they filed.
  --
  --     `legal_acceptances` is the residual-PII case: `ip_address` and
  --     `user_agent` are the person's literal IP and device string, the same
  --     class as `login_history` (step 4f, ERASEd) — but unlike login history
  --     this table is an append-only record that terms version X was accepted
  --     at time T, which has aggregate value that survives the person. So the
  --     ROW stays and the identity goes: user_id, ip_address and user_agent
  --     are all nulled. What remains cannot be tied back to anybody.
  --
  --     `reports.reporter_id` is somebody ELSE's protection. Deleting the row
  --     would erase a safety filing about the person it names, who has not
  --     asked to be forgotten and may still be on the platform — so the report
  --     survives and only the reporter's identity is dropped.
  --     `reports.reported_id` is deliberately NOT touched: it is a bare uuid
  --     with no PII beside it, the profile behind it is already redacted by
  --     step 4e, and it is the substance of another user's report.
  --
  --     Both columns were NOT NULL until the ALTERs above, for the same reason
  --     the 13 columns in 20260901033011 / 20260902014651 were.
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.legal_acceptances
         SET user_id = NULL, ip_address = NULL, user_agent = NULL
       WHERE user_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_consent_an FROM upd;
  END IF;

  IF to_regclass('public.reports') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.reports SET reporter_id = NULL
       WHERE reporter_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_reports_an FROM upd;
  END IF;

  RETURN jsonb_build_object(
    'user_id',                          p_user_id,
    'jobs_deleted',                     v_jobs_deleted,
    'jobs_kept_fk_referenced',          v_jobs_kept_fk,
    'jobs_redacted',                    v_jobs_redacted,
    'messages_deleted',                 v_messages,
    'notifications_deleted',            v_notifications,
    'push_tokens_deleted',              v_push_tokens,
    'notification_preferences_deleted', v_prefs,
    'payout_rows_redacted',             v_payouts,
    'profile_redacted',                 v_profile,
    'notification_logs_deleted',        v_nolog,
    'login_history_deleted',            v_login,
    'saved_jobs_deleted',               v_saved,
    'fraud_flags_deleted',              v_fraud,
    'referral_codes_anonymised',        v_ref_codes,
    'referral_credits_deleted',         v_ref_credits,
    'referral_credits_anonymised',      v_ref_credits_an,
    'referrals_deleted',                v_referrals,
    'referrals_anonymised',             v_referrals_an,
    'group_roster_anonymised',          v_roster,
    'analytics_events_anonymised',      v_analytics,
    'error_logs_anonymised',            v_errorlogs,
    'pif_recipient_emails_cleared',     v_pif,
    'job_tracking_deleted',             v_tracking,
    'helper_availability_deleted',      v_availability,
    'favorite_helpers_deleted',         v_favorites,
    'legal_acceptances_anonymised',     v_consent_an,
    'reports_anonymised',               v_reports_an
  );
END $$;

COMMENT ON FUNCTION public.purge_user_data(uuid) IS
  'Database half of an account deletion, applied atomically. Erases PII and '
  'unfunded jobs, redacts funded jobs and the profile, stamps the payout '
  'ledger, and clears the no-FK tables (notification_logs, login_history, '
  'saved_jobs, fraud_flags, referral_*, job_tracking, helper_availability, '
  'favorite_helpers) that no cascade rule can reach, anonymising the ones that '
  'are somebody else''s record (group roster, analytics, error_logs, '
  'legal_acceptances, reports). Idempotent - safe to re-run after a partial '
  'failure. Called by the delete-own-account, admin-delete-user and '
  'cleanup-abandoned-accounts edge functions immediately before '
  'auth.admin.deleteUser; the FK CASCADE/SET NULL rules finish the job. '
  'Returns per-step row counts so callers never have to infer that a write '
  'happened from the absence of an error.';

-- Privileges are preserved by CREATE OR REPLACE, but restated so a replay onto
-- a fresh database lands in the same state as prod.
REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role';
  END IF;
END $$;

-- ── 3. Backfill the deletions that already happened ─────────────────────────
-- purge_user_data() only governs deletions from here on. 20260902035527 made
-- the same argument for its own ten tables and backfilled them; these five were
-- not in that list because they were not yet known. Same idiom, same ownership
-- test: NOT EXISTS against auth.users, which is the live owner set itself.
--
-- Prod holds 8 such rows today, all in legal_acceptances, all carrying an IP
-- and a user agent. The other four tables are expected to report 0 - the
-- statements still run, because "expected 0" is exactly the assumption worth
-- having a guarded statement verify rather than assert.
DO $$
DECLARE
  n int;
  total int := 0;
BEGIN
  IF to_regclass('public.job_tracking') IS NOT NULL THEN
    DELETE FROM public.job_tracking t
     WHERE t.helper_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.helper_id);
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    IF n > 0 THEN RAISE NOTICE 'erased % orphan job_tracking row(s)', n; END IF;
  END IF;

  IF to_regclass('public.helper_availability') IS NOT NULL THEN
    DELETE FROM public.helper_availability t
     WHERE t.helper_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.helper_id);
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    IF n > 0 THEN RAISE NOTICE 'erased % orphan helper_availability row(s)', n; END IF;
  END IF;

  -- Both directions, same reason as step 4j.
  IF to_regclass('public.favorite_helpers') IS NOT NULL THEN
    DELETE FROM public.favorite_helpers t
     WHERE (t.customer_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.customer_id))
        OR (t.helper_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.helper_id));
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    IF n > 0 THEN RAISE NOTICE 'erased % orphan favorite_helpers row(s)', n; END IF;
  END IF;

  RAISE NOTICE 'backfill: % orphan row(s) erased across the three ERASE tables', total;
END $$;

DO $$
DECLARE n int;
BEGIN
  -- The residual-PII one. Clears the IP and user agent as well as the owner,
  -- because those are the columns that make the surviving row identifying.
  IF to_regclass('public.legal_acceptances') IS NOT NULL THEN
    UPDATE public.legal_acceptances t
       SET user_id = NULL, ip_address = NULL, user_agent = NULL
     WHERE t.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'anonymised % orphan legal_acceptances row(s)', n; END IF;
  END IF;

  IF to_regclass('public.reports') IS NOT NULL THEN
    UPDATE public.reports t
       SET reporter_id = NULL
     WHERE t.reporter_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.reporter_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'anonymised % orphan reports row(s) by reporter_id', n; END IF;
  END IF;
END $$;
