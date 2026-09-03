-- Account deletion: the remaining (table, column) pairs that name a user and
-- have no foreign key to auth.users.
--
-- ── How the set was derived ─────────────────────────────────────────────────
-- NOT from a list. Every previous pass on this problem worked from an
-- enumeration that was also its own definition of correctness, so a missing
-- member could never make it fail. `20260902014651` deleted one test account
-- and looked for that uuid — blind to any table the account held no rows in.
-- `20260902051631` seeded rows first, which is better, but still only covers
-- the tables somebody thought to seed.
--
-- This set was derived from the live catalog and the live DATA, against prod
-- (fncmgoasalhdgfwzhsqa, 2026-09-03), in four passes:
--
--   1. Every uuid column in `public` that is not a primary key and has NO
--      foreign key constraint of any kind        -> 54 candidate columns.
--   2. For each candidate, the actual values were compared against the live
--      `auth.users` set with dynamic SQL (`query_to_xml`), so that "is this a
--      user identifier?" is answered by the data rather than by the column
--      name. That is what separates `notification_logs.job_id` (0 values match
--      a user, 61 match a job) from `admin_audit_log.admin_id` (44 match a
--      user) without anybody having to know what either column means.
--   3. Columns on empty tables cannot be classified that way — a zero count
--      proves nothing — so those were classified structurally and by their
--      call sites. That is the only reason `job_checkins`, `email_tracking`,
--      `helper_w9_records`, `saved_searches`, `helper_preferred_parishes`,
--      `helper_shadowbans` and `broadcast_dismissals` are in scope at all:
--      every one holds zero rows today and would have measured clean.
--   4. Identifiers that are not uuids — text columns holding an email, an IP
--      or a device string — because a purge keyed entirely on uuid cannot see
--      them by construction. That pass found `email_send_log`.
--
-- Pass 2 also RULED OUT three columns that a name-based sweep files every
-- time: `jobs.business_id`, `helper_w9_records.business_id` and
-- `favorite_helpers.business_account_id` referenced `public.businesses`, which
-- `20260828011811` dropped. They are unbacked, 100% NULL, and name no user.
--
-- Result: 25 uuid (table, column) pairs plus 2 text columns that this function
-- did not touch. Each is decided below as PURGE, ANONYMISE or RETAIN, and the
-- retains are recorded as COMMENTs on the objects themselves so the next
-- census reads them as decisions rather than re-filing them as misses.
--
-- ── Standing, not urgency ───────────────────────────────────────────────────
-- Zero accounts have ever completed deletion in prod (`profiles` where
-- `anonymized_at IS NOT NULL` = 0 of 40), so none of this is live damage; it is
-- entirely prospective. What changed is reachability: `20260903014600` made
-- in-app deletion available to banned users, as Apple 5.1.1(v) requires.
--
-- The exposure is measured, not assumed. One arbitrary prod account on
-- 2026-09-03 would leave behind 5 `user_violations`, 1 `admin_user_notes` row
-- and 6 `email_send_log` rows naming their email address. Across the table,
-- `email_send_log` holds 169 rows whose `recipient_email` matches a current
-- user and has no user column at all.
--
-- ── No destructive DDL ──────────────────────────────────────────────────────
-- Every column this function newly writes to is already nullable, and every
-- row it newly deletes lives in a table reachable by user id. So there is no
-- ALTER, no DROP NOT NULL and no constraint change: the whole migration is one
-- CREATE OR REPLACE plus five COMMENTs, and is replay-safe by construction.

-- ---------------------------------------------------------------------------
-- The deliberate retains, recorded where they are true.
--
-- Each of these keeps a user id that outlives the account ON PURPOSE. Writing
-- the reason onto the object is the only way a future census can tell "decided
-- to keep" apart from "nobody looked" — which is the exact failure this whole
-- line of migrations exists to stop.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.helper_w9_records') IS NOT NULL THEN
    EXECUTE $c$
      COMMENT ON TABLE public.helper_w9_records IS
        'RETAINED THROUGH ACCOUNT DELETION, deliberately. A W-9 is a tax '
        'record, and typed_signature + ip + signed_at together ARE the ESIGN '
        'attribution trail: an anonymised W-9 is not a W-9, and the IRS '
        'retention period outlives the account. Erasure is refused here on a '
        'legal-obligation basis, not overlooked. Census: 20260903035008.'$c$;
  END IF;

  IF to_regclass('public.user_bans') IS NOT NULL THEN
    EXECUTE $c$
      COMMENT ON TABLE public.user_bans IS
        'RETAINED THROUGH ACCOUNT DELETION, deliberately. This is the formal '
        'enforcement record, and 20260903014600 built retain_ban_on_deletion '
        'specifically so its EFFECT survives deletion as an email hash. '
        'Deleting the source row while keeping the hash would be incoherent, '
        'and would make purge_user_data depend on that retention having '
        'succeeded - a fail-open coupling in the one path that must fail '
        'closed. Census: 20260903035008.'$c$;
  END IF;

  IF to_regclass('public.tips') IS NOT NULL THEN
    EXECUTE $c$
      COMMENT ON TABLE public.tips IS
        'tipper_id and helper_id are RETAINED through account deletion for '
        'now. Both are NOT NULL on a settled payment carrying a Stripe id, so '
        'the payout_transfers treatment (SET NULL plus a helper_redacted_at '
        'stamp) would require dropping those constraints - a data-model change '
        'on a money table, which belongs to the money lane, not to lifecycle. '
        'Filed as a cross-lane lead, not silently accepted. Census: '
        '20260903035008.'$c$;
  END IF;

  IF to_regclass('public.instant_payouts') IS NOT NULL THEN
    EXECUTE $c$
      COMMENT ON TABLE public.instant_payouts IS
        'helper_id is RETAINED through account deletion for now, for the same '
        'reason as public.tips: NOT NULL on a row carrying a Stripe payout id. '
        'Cross-lane lead for the money lane. Census: 20260903035008.'$c$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.purge_user_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Added by 20260903035008.
  v_email          text;
  v_searches       int := 0;
  v_parishes       int := 0;
  v_dismissals     int := 0;
  v_emailtrack     int := 0;
  v_checkins       int := 0;
  v_violations     int := 0;
  v_shadowbans     int := 0;
  v_adminnotes     int := 0;
  v_blocks         int := 0;
  v_viol_an        int := 0;
  v_jobs_actor_an  int := 0;
  v_reviewer_an    int := 0;
  v_sendlog        int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'purge_user_data: p_user_id is required';
  END IF;

  -- 0. Capture the email BEFORE anything nulls it.
  --
  --    `email_send_log` (step 4q) has no user column at all — `recipient_email`
  --    is the only link to a person, so the address is the only key that can
  --    reach it. Step 4e nulls `profiles.email` and the caller deletes the auth
  --    user immediately after, so this is the last point at which it is
  --    knowable.
  --
  --    auth.users leads because it is the authoritative copy and is still
  --    present here (the auth delete is the caller's step 4, after this RPC).
  --    On a RETRY following a partial run both may be gone; v_email is then
  --    NULL and step 4q no-ops, which is correct — the first run already did
  --    it. Same reasoning as the `anonymized_at` guard on 4e.
  SELECT COALESCE(
           (SELECT u.email::text FROM auth.users u WHERE u.id = p_user_id),
           (SELECT p.email       FROM public.profiles p WHERE p.user_id = p_user_id)
         )
    INTO v_email;

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
  --
  --     NOTE (20260903035008): step 4n now deletes this user's
  --     `user_violations`, one of those eight blockers. It runs AFTER this
  --     loop, deliberately — moving it earlier would make strictly more jobs
  --     erasable, and quietly widening a destructive predicate is not a change
  --     to make as a side effect of a PII sweep. Blocked jobs are retained and
  --     redacted by 4b, which is the safe outcome either way.
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

  -- 20260903035008: `user_agent` joins `user_id` here. Nulling the actor and
  -- leaving the device string behind is the same half-measure this function
  -- already rejected for `legal_acceptances` at 4k, which nulls user_id,
  -- ip_address and user_agent together. 271 prod rows carry both today.
  IF to_regclass('public.error_logs') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.error_logs SET user_id = NULL, user_agent = NULL
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

  -- ══ 4l–4q. 20260903035008 — the remaining no-FK user columns ══════════════
  --
  --   One rule applied throughout, so the calls are consistent rather than
  --   case-by-case. Each clause is a precedent this function already set:
  --
  --     * The user's OWN artifact, with no third-party value        -> ERASE.
  --     * A record that JUDGES or CONSTRAINS this user and can no longer
  --       constrain anyone once the account is gone                 -> ERASE
  --       (the `fraud_flags` precedent at 4f, argued in full there).
  --     * A record of an ACTION AN ADMIN TOOK                       -> RETAIN
  --       (the `admin_audit_log` precedent at 4g-bis).
  --     * A record belonging to a COUNTERPARTY: keep the row, drop the
  --       departing user's identity  -> ANONYMISE (the `reports.reporter_id`
  --       precedent at 4k).

  -- 4l. ERASE — their own settings and their own UI state. No counterparty and
  --     no aggregate value, and `saved_searches.location_keyword` is a street
  --     address they typed. `helper_preferred_parishes` is the twin of
  --     `helper_availability` at 4j: both are the service-area configuration of
  --     a helper who has left.
  IF to_regclass('public.saved_searches') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.saved_searches WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_searches FROM del;
  END IF;

  IF to_regclass('public.helper_preferred_parishes') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.helper_preferred_parishes WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_parishes FROM del;
  END IF;

  IF to_regclass('public.broadcast_dismissals') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.broadcast_dismissals WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_dismissals FROM del;
  END IF;

  -- 4m. ERASE — residual IP, device and location telemetry: the `login_history`
  --     class at 4f, which this function already erases rather than anonymises.
  --
  --     `email_tracking` carries `ip_address` and `user_agent` beside the open
  --     or click. `job_checkins` carries `latitude`, `longitude` and a free
  --     `note`, and it is the exact twin of `job_tracking` at 4i — same shape,
  --     same FK-to-jobs-only, same argument: a co-ordinate is identifying on
  --     its own. It was missed there because it holds zero rows, and a
  --     data-driven census cannot see an empty table.
  --
  --     Scoped to this user's OWN check-ins, so the counterparty's half of the
  --     arrival record is untouched. The gate that reads it (`arrivalGate.ts`)
  --     only runs on live jobs, and deletion is already refused while any job
  --     is live (`findActiveWork`), so nothing in flight can depend on these.
  IF to_regclass('public.email_tracking') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.email_tracking WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_emailtrack FROM del;
  END IF;

  IF to_regclass('public.job_checkins') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.job_checkins WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_checkins FROM del;
  END IF;

  -- 4n. ERASE — judgments about this user that can no longer gate anything.
  --     Identical reasoning to `fraud_flags` at 4f.
  --
  --     `user_violations` is the consequence ladder's input; `helper_shadowbans`
  --     is a soft, auto-expiring visibility sanction; and `admin_user_notes.note`
  --     is free text an admin wrote ABOUT this person — the densest PII of the
  --     three. None can constrain an account that does not exist, and a
  --     returning user is issued a new uuid, so none survives as enforcement
  --     either way.
  --
  --     `user_bans` is the deliberate EXCEPTION and is RETAINED — see the
  --     COMMENT on that table. 20260903014600 built `retain_ban_on_deletion` so
  --     a ban's effect outlives deletion as an email hash; deleting the source
  --     row would contradict that, and would make this function depend on that
  --     retention having succeeded.
  --
  --     Shadowban evasion by delete-and-resignup is NOT closed by this — only
  --     formal bans are carried forward by `retained_bans`. That is a question
  --     about `retained_bans`' scope, filed for trust-and-safety rather than
  --     answered here by keeping a row that enforces nothing.
  IF to_regclass('public.user_violations') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.user_violations WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_violations FROM del;
  END IF;

  IF to_regclass('public.helper_shadowbans') IS NOT NULL THEN
    WITH del AS (DELETE FROM public.helper_shadowbans WHERE helper_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_shadowbans FROM del;
  END IF;

  IF to_regclass('public.admin_user_notes') IS NOT NULL THEN
    -- Scoped to `user_id`, the SUBJECT. `admin_id` is retained: that is which
    -- admin wrote it, the admin_audit_log class.
    WITH del AS (DELETE FROM public.admin_user_notes WHERE user_id = p_user_id RETURNING id)
    SELECT count(*) INTO v_adminnotes FROM del;
  END IF;

  -- 4o. ERASE — the block list, BOTH directions. Exactly the `favorite_helpers`
  --     argument at 4j pointed at the negative list instead of the positive
  --     one: their own blocks leave with them, and their presence in a
  --     stranger's block list would otherwise render forever as a ghost user.
  --
  --     Dropping the rows costs no protection. A block is keyed on a uuid that
  --     will never be issued again, so it is already inert the moment the
  --     account is deleted; protection against a returning bad actor is
  --     `retained_bans`, not this table.
  IF to_regclass('public.user_blocks') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.user_blocks
       WHERE blocker_id = p_user_id OR blocked_id = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_blocks FROM del;
  END IF;

  -- 4p. ANONYMISE — actor pointers on rows that belong to somebody else.
  --
  --     `user_violations.reported_by` is the `reports.reporter_id` case at 4k
  --     exactly: the violation is about a THIRD PARTY who has not asked to be
  --     forgotten, so the row survives and only the reporter's identity goes.
  --
  --     `jobs.cancelled_by` / `disputed_by` / `offered_to_helper_id` are this
  --     user's own participation pointers on a job row whose OTHER
  --     participation pointers — `customer_id`, `helper_id`,
  --     `recurring_helper_id` — are already SET NULL by the FK conversion in
  --     20260901033011. Leaving these three populated makes one row internally
  --     inconsistent: no customer, no helper, but still a named canceller.
  --     `offered_to_helper_id` additionally leaves a job believing it has an
  --     outstanding direct offer to somebody who no longer exists.
  --
  --     `jobs.removed_by` is deliberately NOT in that list. It records an ADMIN
  --     removing a job — an enforcement action, the admin_audit_log class — and
  --     the admin surface that reads it should see the truth.
  --
  --     `profiles.license_reviewed_by` / `insurance_reviewed_by` name the admin
  --     who reviewed somebody ELSE's credential, so they sit on another user's
  --     row and 4e cannot reach them. They are nulled rather than retained
  --     because the schema already decided this exact case:
  --     `helper_verifications.changed_by` is the same concept and carries a real
  --     FK with ON DELETE SET NULL. Consistency with the existing column beats
  --     the general admin-retention rule here.
  IF to_regclass('public.user_violations') IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.user_violations SET reported_by = NULL
       WHERE reported_by = p_user_id
      RETURNING id
    ) SELECT count(*) INTO v_viol_an FROM upd;
  END IF;

  WITH upd AS (
    UPDATE public.jobs
       SET cancelled_by         = CASE WHEN cancelled_by         = p_user_id THEN NULL ELSE cancelled_by         END,
           disputed_by          = CASE WHEN disputed_by          = p_user_id THEN NULL ELSE disputed_by          END,
           offered_to_helper_id = CASE WHEN offered_to_helper_id = p_user_id THEN NULL ELSE offered_to_helper_id END
     WHERE cancelled_by = p_user_id
        OR disputed_by = p_user_id
        OR offered_to_helper_id = p_user_id
    RETURNING id
  ) SELECT count(*) INTO v_jobs_actor_an FROM upd;

  WITH upd AS (
    UPDATE public.profiles
       SET license_reviewed_by   = CASE WHEN license_reviewed_by   = p_user_id THEN NULL ELSE license_reviewed_by   END,
           insurance_reviewed_by = CASE WHEN insurance_reviewed_by = p_user_id THEN NULL ELSE insurance_reviewed_by END
     WHERE license_reviewed_by = p_user_id
        OR insurance_reviewed_by = p_user_id
    RETURNING id
  ) SELECT count(*) INTO v_reviewer_an FROM upd;

  -- 4q. ERASE — the transactional email log, matched by ADDRESS.
  --
  --     `email_send_log` is the one table in this census with no user column at
  --     all: `recipient_email` is the only link to a person, which is why a
  --     purge keyed entirely on uuid has never been able to see it. 169 of its
  --     174 prod rows name a current user's address.
  --
  --     Deleted rather than anonymised, following `notification_logs` at 4f —
  --     its near-twin, which also carries a `recipient_email` and is erased
  --     outright. Nulling the address instead would leave a row that says
  --     nothing and still costs a write.
  --
  --     `v_email` is NULL on a retry after a partial run (step 0), in which
  --     case this no-ops rather than matching an unbounded set. The empty match
  --     is the safe direction here.
  IF v_email IS NOT NULL AND to_regclass('public.email_send_log') IS NOT NULL THEN
    WITH del AS (
      DELETE FROM public.email_send_log
       WHERE lower(btrim(recipient_email)) = lower(btrim(v_email))
      RETURNING id
    ) SELECT count(*) INTO v_sendlog FROM del;
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
    'reports_anonymised',               v_reports_an,
    'saved_searches_deleted',           v_searches,
    'preferred_parishes_deleted',       v_parishes,
    'broadcast_dismissals_deleted',     v_dismissals,
    'email_tracking_deleted',           v_emailtrack,
    'job_checkins_deleted',             v_checkins,
    'user_violations_deleted',          v_violations,
    'helper_shadowbans_deleted',        v_shadowbans,
    'admin_user_notes_deleted',         v_adminnotes,
    'user_blocks_deleted',              v_blocks,
    'user_violations_anonymised',       v_viol_an,
    'jobs_actor_cols_anonymised',       v_jobs_actor_an,
    'credential_reviewers_anonymised',  v_reviewer_an,
    'email_send_log_deleted',           v_sendlog
  );
END $function$;

COMMENT ON FUNCTION public.purge_user_data(uuid) IS
  'Erases, redacts or anonymises everything a departing account leaves behind '
  'that no FK cascade reaches. Must run AFTER retain_ban_on_deletion() (which '
  'reads profiles.email, nulled at step 4e) and BEFORE auth.admin.deleteUser. '
  'Idempotent; safe to retry from any point. The deliberate retains - '
  'admin_audit_log.admin_id, messages.receiver_id, reports.reported_id, '
  'jobs.removed_by, user_bans, helper_w9_records, tips, instant_payouts - are '
  'argued at their own call sites and commented on the tables themselves, so a '
  'later census reads them as decisions rather than as misses.';
