-- Account deletion, part two: the tables no foreign key was ever going to reach.
--
-- ── How these were found ────────────────────────────────────────────────────
-- 20260901033011_account_deletion_retention_policy.sql fixed every FOREIGN KEY
-- that pointed at auth.users. That is necessarily blind to the tables which
-- reference a user by a bare uuid with no FK at all — nothing cascades, nothing
-- sets null, and the retention policy simply never applies to them.
--
-- So instead of reading for them, a test account was deleted end to end against
-- prod (fncmgoasalhdgfwzhsqa, 2026-09-01) and EVERY user-shaped uuid column in
-- the exposed schema — 87 (table, column) pairs — was then queried for the
-- deleted user's id. Ten still held it:
--
--   notification_logs.user_id           7 rows   <-- also holds recipient_email
--   fraud_flags.user_id                 2 rows
--   login_history.user_id               1 row    <-- also holds ip_address
--   referral_codes.user_id              1 row
--   referral_credits.user_id            1 row
--   referral_credits.referred_user_id   1 row
--   referrals.referred_id               1 row
--   saved_jobs.user_id                  1 row
--   group_job_helpers.helper_id         1 row
--   messages.receiver_id                1 row
--
-- Two of those are not pseudonymous at all: `notification_logs.recipient_email`
-- is the person's literal email address and `login_history.ip_address` is their
-- IP. Both survived a "successful" deletion in the previous state of the world,
-- which is the residual-PII case the compliance standard calls a HIGH finding.
--
-- ── Why purge_user_data() and not new foreign keys ──────────────────────────
-- A FK to auth.users would be self-enforcing and therefore better, and it is
-- deliberately NOT what this does. Adding one requires the table to hold zero
-- orphan rows at the moment the constraint is validated, and prod already holds
-- orphans from every deletion that happened before any of this existed. The
-- ALTER would fail on deploy, and cleaning up real (non-test) users' rows to
-- make it pass is not a migration's business. So the rule lives in the purge
-- function, where it can be idempotent and where a pre-existing orphan is
-- simply out of scope rather than a deploy blocker.
--
-- ── Bucket, per table ───────────────────────────────────────────────────────
-- ERASE — the departing person's own artifacts, owned by nobody else:
--   notification_logs   (their email address and what we sent them)
--   login_history       (their IP and user agent)
--   saved_jobs          (their bookmarks)
--   referral_credits WHERE user_id = them   (their own promo balance; this is
--                        an unspent marketing incentive, not a settled
--                        financial record, so it has no retention weight)
--   referrals WHERE referred_id = them      (their own provenance row; the
--                        referrer's already-minted credit is untouched, and
--                        the standard explicitly wants a re-signup on the same
--                        email to start clean)
--   fraud_flags         (a judgment about an identified individual — the same
--                        argument that keeps reviews.reviewee_id on CASCADE.
--                        The account is gone, so the flag can no longer gate
--                        anything; retaining it would keep an accusation about
--                        a person who asked to be forgotten.)
--
-- ANONYMISE — somebody else's record that merely points at them:
--   referral_codes  (user_id nulled AND the code string rewritten. A code left
--                        readable is a live coupon with no owner — a new signup
--                        entering it would mint credit toward an account that
--                        does not exist. Anonymised rather than deleted because
--                        a third party's `referrals` row points at it.)
--   referral_credits.referred_user_id  (the row belongs to the REFERRER, who
--                        earned and possibly spent that credit; sever the
--                        pointer, keep their credit)
--   referrals.referrer_id              (the row belongs to the person THEY
--                        referred; that person's provenance survives)
--   analytics_events.user_id / error_logs.user_id  (an event stream exists to
--                        be counted in aggregate; deleting rows would rewrite
--                        historical funnels every time somebody left. Sever the
--                        actor, keep the count.)
--   group_job_helpers.helper_id        (the roster of a group job belongs to
--                        the POSTER. Deleting the row would quietly shrink the
--                        record of who did a completed, paid job. Same
--                        treatment as jobs.helper_id in the first migration:
--                        keep the row, forget the person.)
--
-- RETAIN, untouched — messages.receiver_id. That row is a message the OTHER
--   party wrote, and their words are their record; purge_user_data already
--   deletes only what the departing user SENT. The dangling receiver uuid is
--   deliberate: it is the "one-sided thread" that honestly represents "the
--   other person left", and nulling it would strip the counterparty's own
--   thread of its addressee. There is nothing left to resolve the uuid to once
--   auth.users and profiles are gone.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Columns that must accept NULL before they can be anonymised.
--    Same discovered-not-assumed loop as the first migration: skip absent
--    tables and columns, skip anything already nullable, so replays are no-ops.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('group_job_helpers', 'helper_id'),
      ('referrals',         'referrer_id'),
      ('referral_credits',  'referred_user_id'),
      -- The referral CODE is anonymised in place rather than deleted, and this
      -- is the column that makes that possible. Deleting the row raised
      -- `23503 referrals_referral_code_id_fkey` and aborted the whole purge
      -- transaction, because a THIRD PARTY's rows point at it: the referee's
      -- `referrals` row records which code they signed up under, and their
      -- `signup_bonus` credit references the referrer's code. Nulling those
      -- pointers instead would have been worse — `check_referral_bonus`
      -- (20260823010000:57) dedupes on `rc.referral_code_id = r.referral_code_id`,
      -- and a NULL there makes `NOT EXISTS` true forever, re-minting the
      -- referee's $5 bonus on every completed job. So the row stays, the
      -- pointers stay valid, and only the identity goes.
      ('referral_codes',    'user_id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE NOTICE 'skip %.% — table absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = spec.tbl
        AND column_name = spec.col
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', spec.tbl, spec.col);
      RAISE NOTICE 'dropped NOT NULL on %.%', spec.tbl, spec.col;
    END IF;
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1b. Two triggers that would each abort the purge transaction outright.
--
--     Neither was found by reading this migration — both were found by a
--     review pass over the FK conversions, and the first one would have made
--     this file's headline promise false for exactly the users it exists to
--     unblock.
-- ───────────────────────────────────────────────────────────────────────────

-- `freeze_group_roster_identity` (20260901030422:96) raises
-- `group_roster_helper_immutable` on ANY change to helper_id, with no
-- service-role escape — unlike every sibling column-lock trigger in this
-- schema, which all check `auth.uid() IS NULL`. Step 4h nulls that column, so
-- the trigger would raise, the whole one-transaction purge would roll back, and
-- every retry would fail identically: anyone who has ever been on a group-job
-- roster becomes permanently undeletable. That is the precise failure class
-- this pair of migrations exists to eliminate.
--
-- The fix is narrower than a blanket service-role escape, and deliberately so.
-- The trigger's own comment says job_id + helper_id ARE the roster row and
-- changing either is "a different assignment". Nulling helper_id is not a
-- different assignment — it is the removal of an assignment's identity, and it
-- can never be used to smuggle a helper onto a crew or past the capacity
-- check. So reassignment stays blocked and redaction is allowed.
DO $trg$
BEGIN
  IF to_regprocedure('public.freeze_group_roster_identity()') IS NULL THEN
    RAISE NOTICE 'skip freeze_group_roster_identity — not defined here';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.freeze_group_roster_identity()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $body$
    BEGIN
      IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
        RAISE EXCEPTION 'group_roster_job_immutable';
      END IF;
      -- Reassignment to a DIFFERENT helper is still forbidden. Redaction to
      -- NULL is not reassignment: purge_user_data() severs the identity of a
      -- departed roster member while keeping the poster's record of who
      -- worked the job.
      IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
        RAISE EXCEPTION 'group_roster_helper_immutable';
      END IF;
      RETURN NEW;
    END;
    $body$;
  $fn$;
END $trg$;

-- `check_referral_bonus` (20260823010000:39) reads
-- `referrals.referrer_id` and inserts it straight into
-- `referral_credits.user_id`, which is NOT NULL (20260311021613:13). Once step
-- 4g anonymises a departed referrer, that INSERT raises 23502 inside an AFTER
-- UPDATE trigger on `jobs` — which rolls back the REFEREE's job-completion
-- update. Permanently, on every retry. A third party who did nothing would be
-- unable to complete their first job because the person who invited them
-- closed their account.
--
-- Crediting a NULL user was never meaningful; the guard below is correct
-- independently of this migration. The referee still receives their own
-- `first_job_bonus` — only the unpayable half is skipped.
DO $trg$
BEGIN
  IF to_regprocedure('public.check_referral_bonus()') IS NULL THEN
    RAISE NOTICE 'skip check_referral_bonus — not defined here';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.check_referral_bonus()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $body$
    DECLARE
      v_referral RECORD;
    BEGIN
      IF NOT (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') THEN
        RETURN NEW;
      END IF;

      IF NEW.helper_id IS NOT NULL THEN
        SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
        INTO v_referral
        FROM public.referrals r
        WHERE r.referred_id = NEW.helper_id
          AND NOT EXISTS (
            SELECT 1 FROM public.referral_credits rc
            WHERE rc.user_id = NEW.helper_id
              AND rc.reason = 'first_job_bonus'
              AND rc.referral_code_id = r.referral_code_id
          );

        IF FOUND THEN
          INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
          VALUES (NEW.helper_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.notifications (user_id, title, message, type, link)
          VALUES (NEW.helper_id, 'Referral bonus earned!',
                  'You completed your first job as a helper and earned a $5 referral credit!', 'payment', '/profile');

          -- The referrer's half, skipped when the referrer has deleted their
          -- account. NOT NULL on referral_credits.user_id and notifications
          -- .user_id would otherwise 23502 and roll back the referee's job.
          IF v_referral.referrer_id IS NOT NULL THEN
            INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
            VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.helper_id)
            ON CONFLICT DO NOTHING;

            INSERT INTO public.notifications (user_id, title, message, type, link)
            VALUES (v_referral.referrer_id, 'Referral bonus!',
                    'Your referral completed their first job as a helper. You earned a $5 credit!', 'payment', '/profile');
          END IF;
        END IF;
      END IF;

      SELECT r.id, r.referrer_id, r.referred_id, r.referral_code_id
      INTO v_referral
      FROM public.referrals r
      WHERE r.referred_id = NEW.customer_id
        AND NOT EXISTS (
          SELECT 1 FROM public.referral_credits rc
          WHERE rc.user_id = NEW.customer_id
            AND rc.reason = 'first_job_bonus'
            AND rc.referral_code_id = r.referral_code_id
        );

      IF FOUND THEN
        INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
        VALUES (NEW.customer_id, 5, 'first_job_bonus', v_referral.referral_code_id, v_referral.referrer_id)
        ON CONFLICT DO NOTHING;

        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.customer_id, 'Referral bonus earned!',
                'Your first posted job was completed — you earned a $5 referral credit!', 'payment', '/profile');

        IF v_referral.referrer_id IS NOT NULL THEN
          INSERT INTO public.referral_credits (user_id, amount, reason, referral_code_id, referred_user_id)
          VALUES (v_referral.referrer_id, 5, 'referrer_bonus', v_referral.referral_code_id, NEW.customer_id)
          ON CONFLICT DO NOTHING;

          INSERT INTO public.notifications (user_id, title, message, type, link)
          VALUES (v_referral.referrer_id, 'Referral bonus!',
                  'Your referral''''s first posted job was completed. You earned a $5 credit!', 'payment', '/profile');
        END IF;
      END IF;

      RETURN NEW;
    END;
    $body$;
  $fn$;
END $trg$;

DO $cmt$
BEGIN
  IF to_regclass('public.group_job_helpers') IS NOT NULL THEN
    COMMENT ON COLUMN public.group_job_helpers.helper_id IS
      'NULL means this roster slot was filled by someone who has since deleted '
      'their account. The row is retained because the roster is the POSTER''s '
      'record of who worked a completed job; only the identity is severed. '
      'UNIQUE(job_id, helper_id) still holds — Postgres treats NULLs as '
      'distinct, so two departed helpers on one job do not collide.';
  END IF;
END $cmt$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. purge_user_data(), extended.
--
--    CREATE OR REPLACE over the definition in
--    20260901033011_account_deletion_retention_policy.sql. Steps 4a–4e are
--    unchanged; 4f–4h are new. The whole body remains ONE transaction with
--    every statement idempotent by predicate, and the return value gains the
--    new per-step counts so a caller still never has to infer that a write
--    happened from the absence of an error.
-- ───────────────────────────────────────────────────────────────────────────
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
    'pif_recipient_emails_cleared',     v_pif
  );
END $$;

COMMENT ON FUNCTION public.purge_user_data(uuid) IS
  'Database half of an account deletion, applied atomically. Erases PII and '
  'unfunded jobs, redacts funded jobs and the profile, stamps the payout '
  'ledger, and clears the no-FK tables (notification_logs, login_history, '
  'saved_jobs, fraud_flags, referral_*) that no cascade rule can reach. '
  'Idempotent — safe to re-run after a partial failure. Called by the '
  'delete-own-account, admin-delete-user and cleanup-abandoned-accounts edge '
  'functions immediately before auth.admin.deleteUser; the FK CASCADE/SET NULL '
  'rules finish the job. Returns per-step row counts so callers never have to '
  'infer that a write happened from the absence of an error.';

-- PUBLIC always exists; the three Supabase roles do not exist on a plain
-- Postgres instance, and this file's replay-safety is proven on one.
REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC;

DO $grants$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM %I', r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role';
  END IF;
END $grants$;
