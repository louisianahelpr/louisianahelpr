-- CORRECTS 20260903022948. That migration said it revoked INSERT on
-- profiles.apple_original_transaction_id. It did not — the statement was a
-- silent no-op, and the commit message asserted otherwise.
--
-- The reason is the exact trap that migration's own comment described, three
-- paragraphs before making the mistake: Postgres keeps table-level and
-- column-level grants as SEPARATE sets, and a table-level grant still implies
-- every column, so a bare column-level REVOKE against a table that holds one
-- emits a warning and changes nothing. I checked that `profiles` has no
-- table-level UPDATE — true, which is why the UPDATE revoke bit — and then
-- assumed INSERT was shaped the same way without looking. It is not:
--
--     anon           DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE
--     authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- Measured after that migration deployed: UPDATE gone from `authenticated` as
-- claimed, INSERT still present on both roles.
--
-- WHY THE FIX IS A POLICY AND NOT A REVOKE. Revoking table-level INSERT would
-- mean re-granting ~90 columns to restore the shape the UPDATE side already
-- has — a large, easily-mistyped change for a column that is inert today. The
-- INSERT path here is not actually guarded by grants at all; it is guarded by
-- the RLS WITH CHECK policy, which is where the other server-owned columns are
-- already pinned (approval_status, subscription_tier, ban_status, idv_status,
-- stripe_account_id, onboarding_fee_paid, email_verified, legacy_manual_review).
-- The credential and IAP columns were simply never added to it. So the fix is
-- to finish the list that already exists rather than to open a second front.
--
-- AND IT MATTERS MORE AFTER 20260903012612 THAN BEFORE IT. That migration made
-- profiles.license_status / insurance_status / *_expires_at authoritative for
-- get_user_credential_tier(). There is no BEFORE INSERT trigger on this table —
-- every one of the five is BEFORE/AFTER UPDATE — so prevent_self_escalation()
-- does not run on insert, and these columns had nothing pinning them there.
--
-- CURRENTLY UNREACHABLE, stated plainly so the severity is not overread: there
-- are ZERO DELETE policies on profiles and a unique index on user_id, so a user
-- who already has a row cannot drop it and insert a forged one, and all 40 prod
-- accounts have one. This closes a latent path, not a live one.
--
-- Every value below is the column's own DEFAULT, so an ordinary insert that
-- names none of them satisfies all of it. Nothing in src/ inserts into profiles
-- (verified by grep); handle_new_user is SECURITY DEFINER and bypasses RLS.

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND approval_status = 'pending'
    AND (ban_status IS NULL OR ban_status = 'active')
    AND idv_status IS NULL
    AND subscription_tier IS NULL
    AND stripe_account_id IS NULL
    AND onboarding_fee_paid = false
    AND email_verified = false
    AND legacy_manual_review = false
    -- ADDED 20260903023314 — the credential gate's inputs. 20260903012612 made
    -- these decide who may take licensed-trade jobs; before this they were
    -- writable on the way in, with no INSERT trigger to catch them.
    AND license_status = 'none'
    AND insurance_status = 'none'
    AND license_expires_at IS NULL
    AND insurance_expires_at IS NULL
    AND is_licensed = false
    AND is_insured = false
    AND background_check_status = 'none'
    AND stripe_identity_verified = false
    -- The Apple IAP receipt anchor — what 20260903022948 was trying and failing
    -- to close.
    AND apple_original_transaction_id IS NULL
    -- Seed rows are an operator concept; a member declaring itself one would be
    -- excluded from browse surfaces and skipped by seed-aware admin queries.
    AND is_seed = false
  );

COMMENT ON POLICY "Users can insert their own profile" ON public.profiles IS
  'A member may create only their OWN profile, and only in its zero-trust state: '
  'every column that any gate reads must arrive at its default. There is no '
  'BEFORE INSERT trigger on this table, so this WITH CHECK is the only thing '
  'standing between an insert and the trust columns.';
