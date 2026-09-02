-- Account deletion: make it possible, and make it honest.
--
-- ── The problem ─────────────────────────────────────────────────────────────
-- Deleting a user was impossible for a third of the accounts on the platform,
-- and destructive of *other people's* records for the rest. Measured against
-- prod (fncmgoasalhdgfwzhsqa) on 2026-08-31, before this migration:
--
--   * 10 of 31 accounts (32%) could not be deleted at all. `auth.admin.
--     deleteUser` answered 500 with a raw `23503`, which delete-own-account
--     passed straight through to the user as:
--       update or delete on table "users" violates foreign key constraint
--       "jobs_helper_id_fkey" on table "jobs"
--     A permanent, unexplained refusal of a legally-required capability.
--   * The blocker is NOT primarily `payout_transfers` (1 user). It is
--     `jobs.helper_id`, which was declared `REFERENCES auth.users(id)` with no
--     ON DELETE clause at all — so it defaulted to NO ACTION and blocked
--     9 users. "Has ever been paid" was the reported scope; the real scope is
--     "has ever been assigned a job".
--   * `reviews.reviewer_id` was ON DELETE CASCADE, so one poster closing their
--     account silently deleted every review they had ever written — moving
--     other helpers' public ratings. Verified: a helper's only 5-star review
--     went 1 -> 0 when its author's account was removed.
--
-- ── The retention policy this encodes ───────────────────────────────────────
-- Three buckets, and every FK below is placed in exactly one of them.
--
--   ERASE — data that identifies the person and belongs to no one else.
--     The profile row and its PII, identity documents, avatars, contact
--     details, push tokens, notifications, private messages, and the jobs they
--     posted that never carried money. Handled by CASCADE (already correct) or
--     by explicit DELETE in purge_user_data() below.
--
--   ANONYMISE — records that must survive because they are someone else's, or
--     because the law says so. Sever the identity, keep the row. This is what
--     the SET NULL conversions below buy. Two kinds:
--       (a) Third-party records. A review a departing poster WROTE is part of
--           the *helper's* reputation, not the poster's property. Deleting it
--           silently rewrites a third party's public rating — for a helper on
--           this platform that is their livelihood. So `reviews.reviewer_id`
--           becomes SET NULL: the rating, the words, and the reviewee keep
--           standing; only the authorship is severed. `reviews.reviewee_id`
--           deliberately KEEPS its CASCADE — a review *about* someone who no
--           longer exists describes a person who is gone, serves no reader,
--           and is itself a judgment about an identified individual.
--       (b) Financial records. `payout_transfers` rows carry statutory
--           retention weight (1099-K / marketplace reporting) and a payout
--           ledger with a hole in it cannot be reconciled. So RESTRICT — which
--           refused the deletion outright — becomes SET NULL: the amount, the
--           platform fee, the job, the dates and the `stripe_transfer_id` all
--           survive, and reconciliation continues against Stripe, which is
--           where the authoritative record lives anyway. `helper_redacted_at`
--           is added so a NULL `helper_id` is unambiguously "redacted for a
--           deleted account" rather than "never populated".
--
--   RETAIN — untouched. `admin_audit_log` (the compliance trail, no FK),
--     Stripe's own records, and the money columns of every ledger row above.
--
-- `payout_transfers.job_id` KEEPS its RESTRICT. That constraint is correct: it
-- stops a job that carries a payout from being deleted. What made it a
-- deletion blocker was `jobs.customer_id` being CASCADE, so removing a poster
-- tried to delete their jobs and RESTRICT refused. Fixing `customer_id` to
-- SET NULL removes the conflict without weakening the ledger guard.
--
-- ── Replay safety ───────────────────────────────────────────────────────────
-- Every statement is guarded. The FK loop discovers the live constraint by
-- querying pg_constraint rather than assuming the `<table>_<column>_fkey`
-- name, skips tables/columns that do not exist (several referenced tables were
-- dropped in 2026-08), and skips a constraint that already has the desired
-- delete action — so a second and third application are both no-ops.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Drop NOT NULL where anonymisation requires the column to accept NULL.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('jobs',               'customer_id'),
      -- `jobs.location` is the poster's street address and is NOT NULL. Step 4b
      -- redacts it, so it has to accept NULL first. Missing this made the whole
      -- purge transaction abort with 23502 for every user who had a job worth
      -- retaining — i.e. exactly the users this migration exists to unblock —
      -- and because the RPC is one transaction, nothing committed and the retry
      -- failed identically forever. A PGlite harness that declared the column
      -- nullable passed 56 assertions over the bug; the schema is prod-shaped now.
      ('jobs',               'location'),
      ('payout_transfers',   'helper_id'),
      ('reviews',            'reviewer_id'),
      ('disputes',           'opener_id'),
      ('job_disputes',       'opened_by'),
      ('job_revisions',      'requested_by'),
      ('pif_credits',        'donor_id'),
      ('skill_endorsements', 'endorser_id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
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
-- 2. Re-point every blocking FK to auth.users at ON DELETE SET NULL.
--
--    Before this ran, the deletion-blocking set was 12 live constraints:
--    one RESTRICT (payout_transfers.helper_id) and eleven that simply never
--    declared an ON DELETE clause and therefore inherited NO ACTION. Every one
--    of them names an *actor* or a *pointer* — who decided a dispute, who
--    issued a strike, who a job was assigned to — and in every case the right
--    answer is the same: keep the record, forget the person.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  spec       record;
  v_conname  text;
  v_deltype  "char";
  v_attnum   smallint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- the two that made deletion impossible for 32% of accounts
      ('jobs',                     'helper_id'),
      ('payout_transfers',         'helper_id'),
      -- CASCADE -> SET NULL: retain the job as a financial record
      ('jobs',                     'customer_id'),
      -- CASCADE -> SET NULL: a review belongs to the person it is about
      ('reviews',                  'reviewer_id'),
      -- CASCADE -> SET NULL: a dispute is a JOINT record. `opener_id` was the
      -- last CASCADE that could destroy a whole settlement — the row carries
      -- BOTH parties' `evidence_urls`, the `decision_text`, the `payout_split`
      -- and the entire execution/settlement block. The opener walking away
      -- must not delete the respondent's evidence or the record of where the
      -- money went. (`disputes` is the live table; `job_disputes` below is the
      -- legacy twin and is handled separately.)
      ('disputes',                 'opener_id'),
      -- CASCADE -> SET NULL: both are things this user GAVE to someone else.
      -- A Pay-It-Forward credit may already have been redeemed and spent on a
      -- third party's job; an endorsement is a signal on another helper's
      -- profile. Same argument as reviews — anonymise the giver, keep the gift.
      ('pif_credits',              'donor_id'),
      ('skill_endorsements',       'endorser_id'),
      -- NO ACTION -> SET NULL: actor / pointer references
      ('jobs',                     'recurring_helper_id'),
      ('profiles',                 'preferred_helper_id'),
      ('disputes',                 'decided_by'),
      ('job_disputes',             'opened_by'),
      ('job_disputes',             'resolved_by'),
      ('job_revisions',            'requested_by'),
      ('user_strikes',             'issued_by'),
      ('pif_credits',              'recipient_id'),
      ('platform_settings',        'updated_by'),
      ('str_calendar_connections', 'preferred_helper_id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE NOTICE 'skip %.% — table absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || spec.tbl)::regclass
      AND a.attname = spec.col
      AND NOT a.attisdropped;

    IF v_attnum IS NULL THEN
      RAISE NOTICE 'skip %.% — column absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    -- Find the live FK on exactly this one column pointing at auth.users.
    -- Discovered, never assumed: relying on the default `<tbl>_<col>_fkey`
    -- name would silently skip any constraint that was ever created with an
    -- explicit CONSTRAINT clause, leaving a blocker in place with the
    -- migration still reporting success.
    SELECT c.conname, c.confdeltype
      INTO v_conname, v_deltype
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = ('public.' || spec.tbl)::regclass
      AND c.confrelid = 'auth.users'::regclass
      AND c.conkey = ARRAY[v_attnum]::smallint[]
    LIMIT 1;

    IF v_conname IS NULL THEN
      RAISE NOTICE 'skip %.% — no FK to auth.users on that column', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    -- 'n' = SET NULL. Already converted (a replay) → nothing to do.
    IF v_deltype = 'n' THEN
      RAISE NOTICE 'skip %.% — already ON DELETE SET NULL', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', spec.tbl, v_conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE SET NULL',
      spec.tbl, v_conname, spec.col
    );
    RAISE NOTICE 'repointed %.% (%) from confdeltype % to SET NULL', spec.tbl, spec.col, v_conname, v_deltype;
  END LOOP;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Make a redacted payout row self-describing.
--    Without this, a NULL helper_id is ambiguous: "we anonymised a deleted
--    helper" and "this row was never fully written" look identical to an
--    auditor. The column is the difference between a retention policy you can
--    evidence and one you can only assert.
-- ───────────────────────────────────────────────────────────────────────────
-- Guarded, like the DO blocks above. These were bare statements, which meant
-- the file's own replay-safety claim held for two thirds of it and quietly
-- failed on any database missing one of these tables — including the plain
-- Postgres harness this repo uses to PROVE replay-safety.
DO $$
BEGIN
  IF to_regclass('public.payout_transfers') IS NOT NULL THEN
    ALTER TABLE public.payout_transfers
      ADD COLUMN IF NOT EXISTS helper_redacted_at timestamptz;
  END IF;

  -- `profiles.anonymized_at` is what makes step 4e's redaction guard honest —
  -- one column meaning "this row has been through the purge", instead of a
  -- hand-maintained sample of the columns it nulls. It also gives an auditor a
  -- straight answer to "when was this person's data removed?" for the window
  -- before the row cascades away.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
  END IF;
END $$;

DO $cmt$
BEGIN
  IF to_regclass('public.payout_transfers') IS NOT NULL THEN
    COMMENT ON COLUMN public.payout_transfers.helper_redacted_at IS
      'Set when helper_id was nulled because the helper deleted their account. '
      'The row is retained for statutory financial reporting; amount_cents, '
      'platform_fee_cents, job_id and stripe_transfer_id remain authoritative '
      'and reconcilable against Stripe. NULL here with a NULL helper_id would '
      'indicate an incomplete write, not a redaction.';
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    COMMENT ON COLUMN public.profiles.anonymized_at IS
      'Set by purge_user_data() when this profile''s PII was redacted during '
      'account deletion. Doubles as that step''s idempotency guard.';
  END IF;

  IF to_regclass('public.reviews') IS NOT NULL THEN
    COMMENT ON COLUMN public.reviews.reviewer_id IS
      'NULL means the author deleted their account. The review is deliberately '
      'retained: it is part of the REVIEWEE''s public record, not the author''s '
      'property, and deleting it would silently rewrite a third party''s rating. '
      'The UI renders a NULL author with its existing missing-name fallback '
      '("a neighbor" on the public wall and the review panel).';
  END IF;
END $cmt$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. purge_user_data() — the database half of a deletion, in ONE transaction.
--
--    Split from the edge function on purpose. Storage objects and the Stripe
--    subscription cannot participate in a Postgres transaction, but everything
--    here can, and a partially-applied redaction is exactly the half-deleted
--    state that is worse than either end. Inside this function it is all or
--    nothing; the edge function orders the non-transactional work around it so
--    that every intermediate state is still coherent.
--
--    Idempotent by construction: every statement is a DELETE or an UPDATE with
--    a predicate that stops matching once it has been applied, so a retry
--    after a failure at any later step is safe and lands in the same place.
--    Returns per-step counts so the caller can log what actually moved rather
--    than assuming a non-error meant a write.
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
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'purge_user_data: p_user_id is required';
  END IF;

  -- 4a. Jobs the user POSTED that touched nobody and no money. Erase outright.
  --
  --     Scoped to customer_id ONLY. A job where this user was merely the
  --     helper is the POSTER's record — deleting it would destroy a third
  --     party's history to satisfy this user's request. The FK conversion in
  --     step 2 nulls helper_id on those instead.
  --
  --     The money test is an ALLOWLIST (`payment_status = 'unpaid'`), not a
  --     denylist. It was a denylist of ('escrow','released','payout_pending'),
  --     which quietly deleted `refunded`, `paid`, `failed` and `cancelled`
  --     jobs — and a REFUNDED job unambiguously did take a payment. When a new
  --     payment_status is added, an allowlist retains the row by default;
  --     a denylist deletes it. For a destructive predicate, default-retain is
  --     the only safe direction.
  --
  --     `helper_id IS NULL` is the other half: once a helper was assigned, the
  --     job is part of THEIR work history too, and deleting it cascades that
  --     helper's `applications` row away with it. An unassigned, unpaid,
  --     unreviewed job is the only kind that genuinely belongs to no one else.
  WITH doomed AS (
    SELECT j.id
    FROM public.jobs j
    WHERE j.customer_id = p_user_id
      AND COALESCE(j.payment_status, 'unpaid') = 'unpaid'
      AND j.helper_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt WHERE pt.job_id = j.id)
      AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.job_id = j.id)
      AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
  ), del AS (
    DELETE FROM public.jobs WHERE id IN (SELECT id FROM doomed) RETURNING id
  )
  SELECT count(*) INTO v_jobs_deleted FROM del;

  -- 4b. Jobs the user POSTED that DID carry money: retain the financial record,
  --     strip the free-text that identifies them. `location` is the poster's
  --     street address and `description` routinely contains a phone number or
  --     gate code. Title, budget, fees, dates, status and the Stripe ids stay
  --     — that is what makes the row reconcilable, and it is also all the
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
  --     cascades and nothing would ever clean them up. Verified against prod:
  --     after a "successful" deletion a message reading
  --       "my address is 123 Elm St, call 555-0142"
  --     was still queryable with a dangling sender_id.
  --     Scoped to `sender_id` ONLY, and that is a correction, not an
  --     oversight. This deleted on `receiver_id` too, which destroys messages
  --     the COUNTERPARTY wrote — the identical mistake to cascading away the
  --     reviews this user authored, just pointed the other way. What someone
  --     else typed is their record; the departing user's own words are the
  --     thing being erased. The counterparty is left with a one-sided thread,
  --     which is the honest representation of "the other person left".
  --
  --     The caller purges `message-attachments` for these rows BEFORE calling
  --     this function, because `messages.attachment_url` is the ONLY pointer
  --     to those objects — deleting the row first would strand the file in
  --     storage permanently with nothing left to locate it by.
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
  --     receive reads as a deliberate redaction. Done BEFORE the auth delete,
  --     while helper_id still identifies the rows.
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
  --     document pointer, and a retry finishes the job. The alternative is a
  --     failure that leaves every identifying field intact.
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
     -- Guarded on `anonymized_at`, NOT on a sample of the columns being
     -- nulled. The guard used to test 7 of the 20, so a profile whose name and
     -- phone were already blank but which still held a licence URL, a bio, a
     -- ZIP and two emergency contacts was judged "already redacted", skipped
     -- entirely, and reported as `profile_redacted: 0` — a success value
     -- covering PII that was never touched. One column that means exactly
     -- "this row has been through the purge" cannot drift out of sync with the
     -- SET list the way a hand-maintained sample of it can.
     WHERE user_id = p_user_id
       AND anonymized_at IS NULL
    RETURNING id
  ) SELECT count(*) INTO v_profile FROM upd;

  RETURN jsonb_build_object(
    'user_id',            p_user_id,
    'jobs_deleted',       v_jobs_deleted,
    'jobs_redacted',      v_jobs_redacted,
    'messages_deleted',   v_messages,
    'notifications_deleted', v_notifications,
    'push_tokens_deleted',   v_push_tokens,
    'notification_preferences_deleted', v_prefs,
    'payout_rows_redacted',  v_payouts,
    'profile_redacted',      v_profile
  );
END $$;

COMMENT ON FUNCTION public.purge_user_data(uuid) IS
  'Database half of an account deletion, applied atomically. Erases PII and '
  'unfunded jobs, redacts funded jobs and the profile, stamps the payout '
  'ledger. Idempotent — safe to re-run after a partial failure. Called by the '
  'delete-own-account and admin-delete-user edge functions immediately before '
  'auth.admin.deleteUser; the remaining FK CASCADE/SET NULL rules finish the '
  'job. Returns per-step row counts so callers never have to infer that a '
  'write happened from the absence of an error.';

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
