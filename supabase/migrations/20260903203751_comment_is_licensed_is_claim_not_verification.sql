-- `profiles.is_licensed` / `is_insured` are CLAIMS, not verification status —
-- and nothing at the database level said so.
--
-- `CredentialsTab.tsx` flips these to `true` client-side the instant a helper
-- toggles the switch and uploads a document — before any admin has looked at
-- it. That is deliberate and correct: the trigger `trg_auto_pending_credentials`
-- stamps the paired `*_status` column 'pending' the same moment, and every
-- real permission check (`get_user_credential_tier()`, the public
-- `CredentialBadge`) reads `*_status = 'verified'`, not this boolean. The
-- claim and the grant are correctly decoupled in code.
--
-- What was missing is that the COLUMN NAME invites exactly the reading this
-- system was built to prevent. "is_licensed" reads as a fact; it is a
-- self-reported claim pending review. Anyone who later queries this column
-- directly — a report, a dashboard, a future feature — without knowing to
-- also check `license_status = 'verified'` would silently trust an
-- unreviewed document. Not renaming it: a rename touches the client submit
-- path, the admin queue, the public badge, `complete-signup`, and every
-- migration and audit lane currently reading it by name, mid-audit. A
-- comment costs nothing and closes the same gap.

COMMENT ON COLUMN public.profiles.is_licensed IS
  'A SELF-REPORTED CLAIM, not a verification result. Set true by the client '
  'the instant a document is uploaded (CredentialsTab.tsx), before any admin '
  'review. Never gate a permission or display a public badge on this column '
  'alone — check license_status = ''verified'' (and, for anything that '
  'unlocks a job, go through get_user_credential_tier(), which additionally '
  'requires a non-null, non-expired license_expires_at).';

COMMENT ON COLUMN public.profiles.is_insured IS
  'A SELF-REPORTED CLAIM, not a verification result. Set true by the client '
  'the instant a document is uploaded (CredentialsTab.tsx), before any admin '
  'review. Never gate a permission or display a public badge on this column '
  'alone — check insurance_status = ''verified'' (and, for anything that '
  'unlocks a job, go through get_user_credential_tier(), which additionally '
  'requires a non-null, non-expired insurance_expires_at).';

COMMENT ON COLUMN public.profiles.license_status IS
  'The real gate. ''pending'' the moment a document is uploaded (see '
  'trg_auto_pending_credentials), only ever moves to ''verified'' or '
  '''rejected'' via the admin RPC review_credential() — a client cannot set '
  'this directly (prevent_self_escalation pins it). This is what '
  'is_licensed is not: an actual verification result.';

COMMENT ON COLUMN public.profiles.insurance_status IS
  'The real gate. ''pending'' the moment a document is uploaded (see '
  'trg_auto_pending_credentials), only ever moves to ''verified'' or '
  '''rejected'' via the admin RPC review_credential() — a client cannot set '
  'this directly (prevent_self_escalation pins it). This is what '
  'is_insured is not: an actual verification result.';
